// MeuAppBula/functions/index.js

const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Remova a importação do cliente do Vision e Gemini daqui do escopo global
// const { ImageAnnotatorClient } = require('@google-cloud/vision');
// const { GoogleGenerativeAI } = require('@google/generative-ai');

// Inicialize o Firebase Admin SDK para acessar o Firestore
admin.initializeApp();
const db = admin.firestore();

// Apenas o require permanece global, a inicialização do cliente será lazy
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const { GoogleGenerativeAI } = require('@google/generative-ai');


/**
 * Cloud Function para processar uma imagem com OCR, extrair nome do medicamento e resumir a bula.
 * Recebe a imagem codificada em Base64 do frontend.
 */
exports.processImageAndGetBula = functions.https.onCall(async (data, context) => {
  // --- INICIALIZAÇÃO DOS CLIENTES MOVIDA PARA DENTRO DA FUNÇÃO ---
  // Isso garante que se houver um problema de configuração, ele será capturado
  // dentro do try-catch da requisição, e não derrubará o contêiner na inicialização.

  let visionClient;
  try {
    visionClient = new ImageAnnotatorClient();
    console.log('VisionClient inicializado com sucesso.');
  } catch (initError) {
    console.error('Erro ao inicializar ImageAnnotatorClient:', initError);
    throw new functions.https.HttpsError('internal', 'Falha ao inicializar o serviço de Visão. Verifique as permissões.');
  }

  let genAI;
  const API_KEY = functions.config().gemini?.key;
  if (!API_KEY) {
    console.error('A chave da API do Gemini não está configurada.');
    throw new functions.https.HttpsError('internal', 'Serviço Gemini não configurado. Verifique a chave da API.');
  }
  try {
    genAI = new GoogleGenerativeAI(API_KEY);
    console.log('Gemini API inicializado com sucesso.');
  } catch (initError) {
    console.error('Erro ao inicializar GoogleGenerativeAI:', initError);
    throw new functions.https.HttpsError('internal', 'Falha ao inicializar o serviço Gemini. Verifique a chave da API.');
  }

  // --- FIM DA INICIALIZAÇÃO DOS CLIENTES ---

  const imageData = data.imageData;
  if (!imageData || typeof imageData !== 'string' || imageData.trim() === '') {
    throw new functions.https.HttpsError('invalid-argument', 'Os dados da imagem (Base64) são obrigatórios.');
  }

  // O check !genAI pode ser removido, pois já é tratado na inicialização acima
  // if (!genAI) {
  //   throw new functions.https.HttpsError('internal', 'Serviço Gemini não configurado. Verifique a chave da API.');
  // }


  let fullTextFromOCR = '';
  try {
    console.log('Realizando OCR na imagem...');
    const [result] = await visionClient.textDetection({
      image: {
        content: imageData
      }
    });
    const detections = result.textAnnotations;
    if (detections && detections.length > 0) {
      fullTextFromOCR = detections[0].description;
      console.log('Texto completo do OCR:', fullTextFromOCR);
    } else {
      console.log('Nenhum texto detectado na imagem.');
      throw new functions.https.HttpsError('not-found', 'Nenhum texto de medicamento detectado na imagem. Tente novamente com uma imagem mais clara.');
    }
  } catch (error) {
    console.error('Erro ao chamar Google Cloud Vision API:', error);
    // Adicionar mais detalhes se o erro for do Vision API para depuração
    if (error.code && error.details) {
        console.error('Detalhes do erro do Vision API:', error.code, error.details);
    }
    throw new functions.https.HttpsError('internal', `Erro ao processar a imagem com OCR: ${error.message || 'Erro desconhecido'}.`);
  }

  // --- Lógica de Extração do Nome do Medicamento do Texto do OCR com Gemini ---
  let nomeMedicamentoFinal = '';
  try {
    console.log('Extraindo nome do medicamento do texto do OCR com Gemini...');
    // Verifique se genAI foi inicializado com sucesso, caso contrário a linha abaixo causaria erro
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
    // Adicionar mais detalhes se o erro for do Gemini para depuração
    if (error.code && error.details) {
        console.error('Detalhes do erro do Gemini (extração de nome):', error.code, error.details);
    }
    throw new functions.https.HttpsError('internal', `Erro interno ao identificar o medicamento: ${error.message || 'Erro desconhecido'}.`);
  }

  // --- Busca e Resumo da Bula no Firestore ---
  try {
    const medicamentosRef = db.collection('medicamentos');
    let querySnapshot;

    // 1. Tentar busca exata no campo 'nome_medicamento'
    querySnapshot = await medicamentosRef
      .where('nome_medicamento', '==', nomeMedicamentoFinal)
      .limit(1)
      .get();

    // 2. Se não encontrou, tentar busca em 'nomes_alternativos' (normalizando o nome extraído)
    if (querySnapshot.empty) {
      const nomeNormalizadoParaBusca = nomeMedicamentoFinal.toLowerCase();
      querySnapshot = await medicamentosRef
        .where('nomes_alternativos', 'array-contains', nomeNormalizadoParaBusado)
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

    // Verifique se genAI foi inicializado com sucesso
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
    // Adicionar mais detalhes se o erro for do Firestore/Gemini para depuração
    if (error.code && error.details) {
        console.error('Detalhes do erro na busca/resumo:', error.code, error.details);
    }
    throw new functions.https.HttpsError('internal', `Ocorreu um erro inesperado ao processar a solicitação de bula: ${error.message || 'Erro desconhecido'}.`);
  }
});