import React, { useState } from 'react';
import {
  View,
  Text,
  Button,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
} from 'react-native';
import { launchCamera, ImagePickerResponse } from 'react-native-image-picker'; // Importe ImagePicker
import functions from '@react-native-firebase/functions'; // Já deve estar importado

interface BulaSummary {
  nomeOficial: string;
  resumo: {
    contraindicacoes: string;
    como_usar: string;
    posologia: string;
    reacoes_adversas: string;
    riscos_cuidados: string;
  };
  fonte: string;
}

// Configuração da Cloud Function (mesmo do firebaseFunctions.ts)
// Você pode mover isso para um arquivo de serviço separado se quiser,
// mas para simplificar aqui, vou deixar direto na tela.
const processImageAndGetBulaFromCloudFunction = async (imageData: string) => {
  try {
    const callable = functions().httpsCallable('processImageAndGetBula');
    const result = await callable({ imageData });
    return result.data;
  } catch (error: any) {
    console.error('Erro ao chamar a Cloud Function:', error.code, error.message);
    if (error.details) {
      console.error('Detalhes do erro:', error.details);
    }
    throw error;
  }
};

const HomeScreen: React.FC = () => {
  const [resumoBula, setResumoBula] = useState<BulaSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null); // Para exibir a imagem tirada

  const handleLaunchCamera = async () => {
    setLoading(true);
    setResumoBula(null);
    setError(null);
    setImageUri(null);

    const options = {
      mediaType: 'photo' as 'photo', // Assegura o tipo correto para 'photo'
      includeBase64: true, // Crucial para enviar para Cloud Functions
      maxHeight: 1200, // Limitar o tamanho da imagem para envio eficiente
      maxWidth: 1200,
      quality: 0.8, // Qualidade da imagem
    };

    launchCamera(options, async (response: ImagePickerResponse) => {
      setLoading(false); // Desativa o spinner imediatamente após a resposta da câmera

      if (response.didCancel) {
        console.log('Usuário cancelou a câmera');
        setError('Captura de imagem cancelada.');
      } else if (response.errorMessage) {
        console.error('ImagePicker Error: ', response.errorMessage);
        setError('Erro ao acessar a câmera: ' + response.errorMessage);
      } else if (response.assets && response.assets.length > 0) {
        const asset = response.assets[0];
        if (asset.uri && asset.base64) {
          setImageUri(asset.uri); // Exibe a imagem no app
          setLoading(true); // Ativa o spinner novamente para o processamento da bula

          try {
            console.log('Enviando imagem para Cloud Function...');
            const result = await processImageAndGetBulaFromCloudFunction(asset.base64);
            setResumoBula(result);
            setError(null);
          } catch (err: any) {
            console.error('Erro ao processar imagem e buscar bula:', err);
            setError(err.message || 'Ocorreu um erro ao processar a imagem e buscar a bula.');
            setResumoBula(null);
          } finally {
            setLoading(false); // Desativa o spinner ao final do processo
          }
        } else {
          setError('Não foi possível obter os dados da imagem.');
        }
      }
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FarmCam - Identificador de Bulas</Text>

      <Button title="Abrir Câmera e Identificar Bula" onPress={handleLaunchCamera} disabled={loading} />

      {loading && <ActivityIndicator size="large" color="#0000ff" style={styles.spinner} />}
      {error && <Text style={styles.errorText}>Erro: {error}</Text>}

      {imageUri && (
        <View style={styles.imagePreviewContainer}>
          <Text style={styles.imagePreviewTitle}>Imagem Capturada:</Text>
          <Image source={{ uri: imageUri }} style={styles.imagePreview} />
        </View>
      )}

      {resumoBula && (
        <ScrollView style={styles.resumoContainer}>
          <Text style={styles.resumoTitle}>Bula Resumida de {resumoBula.nomeOficial}</Text>
          <Text style={styles.resumoFonte}>(Fonte: {resumoBula.fonte})</Text>

          {resumoBula.resumo.contraindicacoes && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Contraindicações:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.contraindicacoes}</Text>
            </View>
          )}
          {resumoBula.resumo.como_usar && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Como Usar / Modo de Uso:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.como_usar}</Text>
            </View>
          )}
          {resumoBula.resumo.posologia && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Posologia:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.posologia}</Text>
            </View>
          )}
          {resumoBula.resumo.reacoes_adversas && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Reações Adversas e Efeitos Colaterais:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.reacoes_adversas}</Text>
            </View>
          )}
          {resumoBula.resumo.riscos_cuidados && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Riscos e Cuidados:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.riscos_cuidados}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#333',
  },
  spinner: {
    marginTop: 30,
  },
  errorText: {
    color: 'red',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
    fontWeight: 'bold',
  },
  imagePreviewContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  imagePreviewTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  imagePreview: {
    width: 250,
    height: 250,
    resizeMode: 'contain',
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 5,
  },
  resumoContainer: {
    marginTop: 30,
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 5,
  },
  resumoTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#222',
  },
  resumoFonte: {
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 18,
    color: '#777',
  },
  resumoItem: {
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 15,
  },
  itemTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#444',
    marginBottom: 7,
  },
  itemContent: {
    fontSize: 15,
    color: '#555',
    lineHeight: 23,
  },
});

export default HomeScreen;