const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');

// Inicialize o cliente do Cloud Vision
const visionClient = new ImageAnnotatorClient();

// ... outras importações existentes ...

/**
 * Nova Cloud Function para processar uma imagem com OCR e retornar o resumo da bula.
 * Recebe a imagem codificada em Base64 do frontend.
 */
exports.processImageAndGetBula = functions.https.onCall(async (data, context) => {
    // Opcional: Verificação de autenticação
    // if (!context.auth) {
    //   throw new functions.https.HttpsError('unauthenticated', 'Apenas usuários autenticados podem acessar este recurso.');
    // }

    const imageData = data.imageData; // A imagem em Base64
    if (!imageData || typeof imageData !== 'string' || imageData.trim() === '') {
        throw new functions.https.HttpsError('invalid-argument', 'Os dados da imagem (Base64) são obrigatórios.');
    }

    let fullTextFromOCR = '';
    try {
        // Performar OCR usando Google Cloud Vision API
        console.log('Realizando OCR na imagem...');
        const [result] = await visionClient.textDetection({
            image: {
                content: imageData // A imagem Base64 é o conteúdo
            }
        });
        const detections = result.textAnnotations;
        if (detections && detections.length > 0) {
            fullTextFromOCR = detections[0].description; // O primeiro item geralmente contém todo o texto detectado
            console.log('Texto completo do OCR:', fullTextFromOCR);
        } else {
            console.log('Nenhum texto detectado na imagem.');
            throw new functions.https.HttpsError('not-found', 'Nenhum texto de medicamento detectado na imagem. Tente novamente com uma imagem mais clara.');
        }
    } catch (error) {
        console.error('Erro ao chamar Google Cloud Vision API:', error);
        throw new functions.https.HttpsError('internal', 'Erro ao processar a imagem com OCR. Verifique a imagem ou tente novamente.');
    }

    // --- Lógica de Extração do Nome do Medicamento do Texto do OCR ---
    let nomeMedicamentoFinal = '';
    try {
        console.log('Extraindo nome do medicamento do texto do OCR com Gemini...');
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        const promptParaNome = `
        Dado o seguinte texto extraído da caixa de um medicamento, identifique e retorne apenas o nome oficial do medicamento. 
        Se houver nomes de marca e nomes genéricos, prefira o nome genérico se for claramente identificável. 
        Retorne apenas o nome do medicamento, sem explicações ou frases adicionais.
        Se não conseguir identificar um nome de medicamento claro, retorne "NÃO_IDENTIFICADO".

        Exemplos:
        Texto: "PARACETAMOL 500mg Comprimidos"
        Nome: "Paracetamol"

        Texto: "TYLENOL 750mg"
        Nome: "Tylenol"

        Texto: "DIPIRONA SÓDICA 500 MG"
        Nome: "Dipirona Sódica"

        Texto: "R$ 19,99 VENCIMENTO 12/25"
        Nome: "NÃO_IDENTIFICADO"

        Texto da caixa:
        ${fullTextFromOCR}
        `;

        const resultNome = await model.generateContent(promptParaNome);
        const responseNome = await resultNome.response;
        const extractedName = responseNome.text().trim();

        if (extractedName === "NÃO_IDENTIFICADO" || extractedName.length < 3) {
            throw new functions.https.HttpsError('not-found', 'Não foi possível identificar o nome do medicamento a partir da imagem. Tente uma foto mais clara ou com mais detalhes.');
        }
        nomeMedicamentoFinal = extractedName;
        console.log('Nome do medicamento extraído:', nomeMedicamentoFinal);

    } catch (error) {
        console.error('Erro ao extrair nome do medicamento com Gemini:', error);
        throw new functions.https.HttpsError('internal', 'Erro interno ao identificar o medicamento. Tente novamente.');
    }

    // --- Busca e Resumo da Bula ---
    try {
        const medicamentosRef = db.collection('medicamentos');
        let querySnapshot;

        // Tentativa 1: Busca exata no campo 'nome_medicamento'
        querySnapshot = await medicamentosRef
            .where('nome_medicamento', '==', nomeMedicamentoFinal)
            .limit(1)
            .get();

        // 2. Se não encontrou, tentar busca em 'nomes_alternativos' (normalizando o nome extraído)
        if (querySnapshot.empty) {
            const nomeNormalizadoParaBusca = nomeMedicamentoFinal.toLowerCase();
            querySnapshot = await medicamentosRef
                .where('nomes_alternativos', 'array-contains', nomeNormalizadoParaBusca)
                .limit(1)
                .get();
        }

        if (querySnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Bula para "${nomeMedicamentoFinal}" não encontrada no banco de dados. Cadastre o medicamento ou verifique a imagem.`);
        }

        const medicamentoDoc = querySnapshot.docs[0];
        const bulaData = medicamentoDoc.data();
        const bulaCompleta = bulaData.bula_completa;
        const nomeOficial = bulaData.nome_medicamento;

        // Se os resumos já existirem no documento, retorna-os diretamente
        if (bulaData.resumos && Object.keys(bulaData.resumos).length > 0) {
            console.log(`Resumos já existem para "${nomeOficial}". Retornando dados pré-gerados.`);
            return {
                nomeOficial: nomeOficial,
                resumo: bulaData.resumos,
                fonte: 'Firebase (Pré-gerado)'
            };
        }

        if (!bulaCompleta) {
            throw new functions.https.HttpsError('internal', `A bula completa para "${nomeOficial}" não está disponível para resumo.`);
        }

        console.log(`Gerando resumos para "${nomeOficial}" com Gemini API...`);

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        const promptResumo = `
        Dado o seguinte texto de bula de medicamento, por favor, extraia e resuma os seguintes pontos-chave de forma clara e concisa em português:

        1.  **Contraindicações:**
        2.  **Como usar / Modo de Uso:**
        3.  **Posologia:**
        4.  **Quais as reações adversas e os efeitos colaterais:**
        5.  **Riscos e Cuidados (incluindo interações medicamentosas, gravidez, amamentação, etc.):**

        Formate a saída como um objeto JSON onde as chaves correspondem aos títulos dos pontos (ex: "contraindicacoes", "como_usar") e os valores são os resumos em texto. Se alguma informação não estiver explicitamente presente na bula, use "Não especificado na bula." como valor para aquela chave.
        
        Exemplo de formato de saída JSON:
        {
            "contraindicacoes": "Não usar se tiver alergia a X ou Y.",
            "como_usar": "Ingerir 1 comprimido com água.",
            "posologia": "1 comprimido a cada 8 horas.",
            "reacoes_adversas": "Náuseas, tontura.",
            "riscos_cuidados": "Evitar álcool. Consultar médico em caso de gravidez."
        }

        ---
        Texto da Bula:
        ${bulaCompleta}
        ---
        `;

        const resultResumo = await model.generateContent(promptResumo);
        const responseResumo = await resultResumo.response;
        const textResumo = responseResumo.text();

        let resumoGerado;
        try {
            const jsonMatch = textResumo.match(/```json\n(.*?)```/s);
            if (jsonMatch && jsonMatch[1]) {
                resumoGerado = JSON.parse(jsonMatch[1]);
            } else {
                resumoGerado = JSON.parse(textResumo); 
            }
        } catch (parseError) {
            console.error("Erro ao parsear JSON do Gemini (resumo):", parseError);
            throw new functions.https.HttpsError('internal', 'Erro ao processar o resumo da bula gerado pelo Gemini. Formato inválido.');
        }

        const expectedKeys = ["contraindicacoes", "como_usar", "posologia", "reacoes_adversas", "riscos_cuidados"];
        for (const key of expectedKeys) {
            if (!(key in resumoGerado)) {
                console.warn(`Chave "${key}" esperada, mas não encontrada no resumo do Gemini.`);
                resumoGerado[key] = "Não especificado ou não gerado pelo Gemini.";
            }
        }

        await medicamentoDoc.ref.update({
            resumos: resumoGerado
        });

        console.log(`Resumos gerados e salvos para "${nomeOficial}".`);
        return {
            nomeOficial: nomeOficial,
            resumo: resumoGerado,
            fonte: 'Gemini (Novo Resumo Gerado)'
        };

    } catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        console.error("Erro inesperado na Cloud Function (busca/resumo):", error);
        throw new functions.https.HttpsError('internal', 'Ocorreu um erro inesperado ao processar a solicitação de bula.');
    }
});
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Inicialize o Firebase Admin SDK para acessar o Firestore
admin.initializeApp();
const db = admin.firestore();

// Inicialize o Gemini API com a chave armazenada de forma segura
const API_KEY = functions.config().gemini.key;
if (!API_KEY) {
  console.error('A chave da API do Gemini não está configurada. Por favor, execute: firebase functions:config:set gemini.key="SUA_CHAVE"');
}
const genAI = new GoogleGenerativeAI(API_KEY);

/**
 * Função de Cloud Function chamável (HTTPS callable) para buscar e resumir bulas de medicamentos.
 * Recebe o nome do medicamento detectado pelo OCR e retorna o resumo da bula.
 */
exports.getBulaSummary = functions.https.onCall(async (data, context) => {
  // Opcional: Para ambientes de produção, considere verificar a autenticação do usuário.
  // if (!context.auth) {
  //   throw new functions.https.HttpsError('unauthenticated', 'Apenas usuários autenticados podem acessar este recurso.');
  // }

  const nomeMedicamentoOCR = data.nomeMedicamento;

  if (!nomeMedicamentoOCR || typeof nomeMedicamentoOCR !== 'string' || nomeMedicamentoOCR.trim() === '') {
    throw new functions.https.HttpsError('invalid-argument', 'O nome do medicamento é obrigatório e deve ser uma string não vazia.');
  }

  // Normaliza o nome para busca (remove espaços extras, converte para minúsculas)
  const nomeNormalizado = nomeMedicamentoOCR.trim().toLowerCase();

  try {
    const medicamentosRef = db.collection('medicamentos');
    let querySnapshot;

    // --- Estratégia de Busca da Bula ---
    // 1. Tentar busca exata no campo 'nome_medicamento'
    querySnapshot = await medicamentosRef
      .where('nome_medicamento', '==', nomeMedicamentoOCR) // Manter case-sensitive aqui pode ser útil se seus nomes são exatos
      .limit(1)
      .get();

    // 2. Se não encontrou, tentar busca em 'nomes_alternativos' (com normalização)
    if (querySnapshot.empty) {
      querySnapshot = await medicamentosRef
        .where('nomes_alternativos', 'array-contains', nomeNormalizado)
        .limit(1)
        .get();
    }

    // 3. Se ainda não encontrou, você pode adicionar lógicas mais avançadas aqui:
    //    - Iterar por todos os medicamentos e usar uma biblioteca de "fuzzy matching" (ex: Fuse.js)
    //      (Isso exigiria mais leitura do DB e processamento na função, que pode ser mais caro/lento)
    //    - Considerar um serviço de busca de texto completo se a base de dados for muito grande.
    // Para o TCC, as duas primeiras estratégias são um bom começo.

    if (querySnapshot.empty) {
      throw new functions.https.HttpsError('not-found', `Medicamento "${nomeMedicamentoOCR}" não encontrado no banco de dados. Verifique a grafia ou se a bula foi cadastrada.`);
    }

    const medicamentoDoc = querySnapshot.docs[0];
    const bulaData = medicamentoDoc.data();
    const bulaCompleta = bulaData.bula_completa;
    const nomeOficial = bulaData.nome_medicamento;

    // --- Geração ou Retorno do Resumo ---
    // Se os resumos já existirem no documento, retorna-os diretamente
    if (bulaData.resumos && Object.keys(bulaData.resumos).length > 0) {
      console.log(`Resumos já existem para "${nomeOficial}". Retornando dados pré-gerados.`);
      return {
        nomeOficial: nomeOficial,
        resumo: bulaData.resumos,
        fonte: 'Firebase (Pré-gerado)'
      };
    }

    // Se a bula completa não estiver disponível (e os resumos também não), erro
    if (!bulaCompleta) {
      throw new functions.https.HttpsError('internal', `A bula completa para "${nomeOficial}" não está disponível para resumo.`);
    }

    console.log(`Gerando resumos para "${nomeOficial}" com Gemini API...`);

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" }); // Escolha o modelo apropriado
    const prompt = `
    Dado o seguinte texto de bula de medicamento, por favor, extraia e resuma os seguintes pontos-chave de forma clara e concisa em português:

    1.  **Contraindicações:**
    2.  **Como usar / Modo de Uso:**
    3.  **Posologia:**
    4.  **Quais as reações adversas e os efeitos colaterais:**
    5.  **Riscos e Cuidados (incluindo interações medicamentosas, gravidez, amamentação, etc.):**

    Formate a saída como um objeto JSON onde as chaves correspondem aos títulos dos pontos (ex: "contraindicacoes", "como_usar") e os valores são os resumos em texto. Se alguma informação não estiver explicitamente presente na bula, use "Não especificado na bula." como valor para aquela chave.
    
    Exemplo de formato de saída JSON:
    {
      "contraindicacoes": "Não usar se tiver alergia a X ou Y.",
      "como_usar": "Ingerir 1 comprimido com água.",
      "posologia": "1 comprimido a cada 8 horas.",
      "reacoes_adversas": "Náuseas, tontura.",
      "riscos_cuidados": "Evitar álcool. Consultar médico em caso de gravidez."
    }

    ---
    Texto da Bula:
    ${bulaCompleta}
    ---
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    let resumoGerado;
    try {
      // Tenta extrair o JSON se estiver dentro de um bloco de código Markdown
      const jsonMatch = text.match(/```json\n(.*?)```/s);
      if (jsonMatch && jsonMatch[1]) {
        resumoGerado = JSON.parse(jsonMatch[1]);
      } else {
        // Se não houver bloco de código, tenta parsear o texto diretamente
        resumoGerado = JSON.parse(text); 
      }
    } catch (parseError) {
      console.error("Erro ao parsear JSON do Gemini:", parseError);
      throw new functions.https.HttpsError('internal', 'Erro ao processar o resumo da bula gerado pelo Gemini. Formato inválido.');
    }

    // Validação básica para garantir que o Gemini retornou as chaves esperadas
    const expectedKeys = ["contraindicacoes", "como_usar", "posologia", "reacoes_adversas", "riscos_cuidados"];
    for (const key of expectedKeys) {
      if (!(key in resumoGerado)) {
        console.warn(`Chave "${key}" esperada, mas não encontrada no resumo do Gemini.`);
        resumoGerado[key] = "Não especificado ou não gerado pelo Gemini.";
      }
    }

    // Salvar os resumos gerados no Firestore para uso futuro
    await medicamentoDoc.ref.update({
      resumos: resumoGerado
    });

    console.log(`Resumos gerados e salvos para "${nomeOficial}".`);
    return {
      nomeOficial: nomeOficial,
      resumo: resumoGerado,
      fonte: 'Gemini (Novo Resumo Gerado)'
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error; // Propagar erros HttpsError para o cliente React Native
    }
    console.error("Erro inesperado na Cloud Function:", error);
    // Para erros não HttpsError, retorne um erro genérico seguro
    throw new functions.https.HttpsError('internal', 'Ocorreu um erro inesperado ao processar a solicitação. Tente novamente mais tarde.');
  }
});