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
  Platform, // Importar Platform
} from 'react-native';
import { launchCamera, launchImageLibrary, ImagePickerResponse, PhotoQuality } from 'react-native-image-picker'; // <<<< Importar launchImageLibrary
import functions from '@react-native-firebase/functions';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions'; // <<<< Importar permissões

interface BulaSummary {
  nomeOficial: string;
  resumo: {
    contraindicacoes?: string;
    como_usar?: string;
    posologia?: string;
    reacoes_adversas?: string;
    riscos_cuidados?: string;
  };
  fonte: string;
}

const processImageAndGetBulaFromCloudFunction = async (imageData: string): Promise<BulaSummary> => {
  try {
    const callable = functions().httpsCallable('processImageAndGetBula');
    const result = await callable({ imageData });
    return result.data as BulaSummary;
  } catch (error: any) {
    console.error('Erro ao chamar a Cloud Function:', error.code, error.message);
    if (error.details) {
      console.error('Detalhes do erro:', error.details);
    }
    let userMessage = 'Ocorreu um erro desconhecido ao processar sua solicitação.';
    if (error.code === 'not-found') {
      userMessage = error.message;
    } else if (error.code === 'invalid-argument') {
      userMessage = error.message;
    } else if (error.code === 'internal') {
        userMessage = error.message;
    }
    throw new Error(userMessage);
  }
};

const HomeScreen: React.FC = () => {
  const [resumoBula, setResumoBula] = useState<BulaSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);

  // --- Função Auxiliar para Processar a Resposta do ImagePicker ---
  const handleImagePickerResponse = async (response: ImagePickerResponse) => {
    if (!response.assets || response.assets.length === 0) {
      setLoading(false); // Só desativa o spinner se não tivermos imagem para processar
      if (response.didCancel) {
        console.log('Usuário cancelou a seleção.');
        setError('Seleção de imagem cancelada.');
      } else if (response.errorMessage) {
        console.error('ImagePicker Error: ', response.errorMessage);
        setError('Erro ao selecionar imagem: ' + response.errorMessage);
      } else {
        setError('Nenhuma imagem selecionada.');
      }
      return;
    }

    const asset = response.assets[0];
    if (asset.uri && asset.base64) {
      setImageUri(asset.uri); // Exibe a imagem no app
      // O spinner já está ativo, então não precisa reativar aqui
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
        setLoading(false);
      }
    } else {
      setLoading(false);
      setError('Não foi possível obter os dados da imagem selecionada.');
    }
  };

  const handleLaunchCamera = async () => {
    setLoading(true);
    setResumoBula(null);
    setError(null);
    setImageUri(null);

    // --- Lógica de Permissão da Câmera ---
    let cameraPermissionStatus;
    if (Platform.OS === 'android') {
        cameraPermissionStatus = await check(PERMISSIONS.ANDROID.CAMERA);
        if (cameraPermissionStatus !== RESULTS.GRANTED) {
            cameraPermissionStatus = await request(PERMISSIONS.ANDROID.CAMERA);
        }
    } else { // iOS
        cameraPermissionStatus = await check(PERMISSIONS.IOS.CAMERA);
        if (cameraPermissionStatus !== RESULTS.GRANTED) {
            cameraPermissionStatus = await request(PERMISSIONS.IOS.CAMERA);
        }
    }

    if (cameraPermissionStatus !== RESULTS.GRANTED) {
        setLoading(false);
        setError('Permissão da câmera não concedida. Por favor, conceda a permissão nas configurações do aplicativo.');
        Alert.alert(
            'Permissão Necessária',
            'Para usar a câmera, precisamos da sua permissão. Por favor, conceda nas configurações do aplicativo.'
        );
        return;
    }
    // --- Fim Lógica de Permissão da Câmera ---

    const options = {
      mediaType: 'photo' as 'photo',
      includeBase64: true,
      maxHeight: 1200,
      maxWidth: 1200,
      quality: 0.8 as PhotoQuality,
    };

    launchCamera(options, handleImagePickerResponse); // Usar a função auxiliar
  };

  // --- Nova Função para Abrir a Galeria ---
  const handleLaunchImageLibrary = async () => {
    setLoading(true);
    setResumoBula(null);
    setError(null);
    setImageUri(null);

    // --- Lógica de Permissão da Galeria/Armazenamento ---
    let photoLibraryPermissionStatus;
    if (Platform.OS === 'android') {
        // Para Android 13 (API 33) e superior, usamos READ_MEDIA_IMAGES
        if (Platform.Version >= 33) {
            photoLibraryPermissionStatus = await check(PERMISSIONS.ANDROID.READ_MEDIA_IMAGES);
            if (photoLibraryPermissionStatus !== RESULTS.GRANTED) {
                photoLibraryPermissionStatus = await request(PERMISSIONS.ANDROID.READ_MEDIA_IMAGES);
            }
        } else { // Para Android 12 (API 32) e anteriores, usamos READ_EXTERNAL_STORAGE
            photoLibraryPermissionStatus = await check(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
            if (photoLibraryPermissionStatus !== RESULTS.GRANTED) {
                photoLibraryPermissionStatus = await request(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
            }
        }
    } else { // iOS
        photoLibraryPermissionStatus = await check(PERMISSIONS.IOS.PHOTO_LIBRARY);
        if (photoLibraryPermissionStatus !== RESULTS.GRANTED) {
            photoLibraryPermissionStatus = await request(PERMISSIONS.IOS.PHOTO_LIBRARY);
        }
    }

    if (photoLibraryPermissionStatus !== RESULTS.GRANTED) {
        setLoading(false);
        setError('Permissão da galeria não concedida. Por favor, conceda a permissão nas configurações do aplicativo.');
        Alert.alert(
            'Permissão Necessária',
            'Para selecionar imagens da galeria, precisamos da sua permissão. Por favor, conceda nas configurações do aplicativo.'
        );
        return;
    }
    // --- Fim Lógica de Permissão da Galeria ---

    const options = {
      mediaType: 'photo' as 'photo',
      includeBase64: true,
      maxHeight: 1200,
      maxWidth: 1200,
      quality: 0.8 as PhotoQuality,
    };

    launchImageLibrary(options, handleImagePickerResponse); // Usar a função auxiliar
  };


  return (
    <View style={styles.container}>
      <Text style={styles.title}>FarmCam - Identificador de Bulas</Text>

      <Button title="Abrir Câmera e Identificar Bula" onPress={handleLaunchCamera} disabled={loading} />
      {/* Novo botão para a galeria */}
      <View style={styles.buttonSpacer} /> {/* Para dar um espaço entre os botões */}
      <Button title="Carregar Imagem da Galeria" onPress={handleLaunchImageLibrary} disabled={loading} color="#4CAF50" />


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

          {resumoBula.resumo.contraindicacoes && resumoBula.resumo.contraindicacoes !== "Não especificado na bula." && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Contraindicações:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.contraindicacoes}</Text>
            </View>
          )}
          {resumoBula.resumo.como_usar && resumoBula.resumo.como_usar !== "Não especificado na bula." && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Como Usar / Modo de Uso:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.como_usar}</Text>
            </View>
          )}
          {resumoBula.resumo.posologia && resumoBula.resumo.posologia !== "Não especificado na bula." && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Posologia:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.posologia}</Text>
            </View>
          )}
          {resumoBula.resumo.reacoes_adversas && resumoBula.resumo.reacoes_adversas !== "Não especificado na bula." && (
            <View style={styles.resumoItem}>
              <Text style={styles.itemTitle}>Reações Adversas e Efeitos Colaterais:</Text>
              <Text style={styles.itemContent}>{resumoBula.resumo.reacoes_adversas}</Text>
            </View>
          )}
          {resumoBula.resumo.riscos_cuidados && resumoBula.resumo.riscos_cuidados !== "Não especificado na bula." && (
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
  buttonSpacer: {
    height: 10, // Espaço entre os botões
  },
});

export default HomeScreen;