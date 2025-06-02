// MeuAppBula/src/services/firebaseFunctions.ts
import functions from '@react-native-firebase/functions';

// Se suas funções não estiverem na região padrão (us-central1), especifique a região
// functions().useFunctionsEmulator('http://localhost:5001'); // Para testar localmente
// functions().region('southamerica-east1'); // Se você configurou suas funções para São Paulo

export const getBulaSummaryFromCloudFunction = async (nomeMedicamento: string) => {
  try {
    // Chama a função 'getBulaSummary' que está no seu backend (Cloud Functions)
    const result = await functions().httpsCallable('getBulaSummary')({ nomeMedicamento });

    // O 'result.data' conterá o retorno da sua Cloud Function
    return result.data;
  } catch (error: any) {
    console.error('Erro ao chamar a Cloud Function:', error.code, error.message);
    if (error.details) {
      console.error('Detalhes do erro:', error.details);
    }
    // Rejeitar a Promise para que a UI possa tratar o erro
    throw error;
  }
};