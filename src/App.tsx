import React from 'react';
import HomeScreen from './screens/HomeScreen';
import firebase from '@react-native-firebase/app'; // Importe o módulo principal do Firebase

// Opcional: Se você estiver usando o emulador de funções para testes locais
// if (__DEV__) { // Apenas em desenvolvimento
//   firebase.functions().useFunctionsEmulator('http://localhost:5001');
// }

const App: React.FC = () => {
  // O SDK do Firebase para React Native geralmente se inicializa automaticamente
  // quando você tem os arquivos de configuração (google-services.json e GoogleService-Info.plist)
  // nas pastas corretas do projeto nativo e importa o módulo `app`.
  // Não é necessário chamar firebase.initializeApp() explicitamente na maioria dos casos,
  // a menos que você tenha uma configuração muito específica.

  // Verificação simples para garantir que o app do Firebase esteja carregado
  if (firebase.apps.length === 0) {
    console.warn('Firebase App ainda não inicializado. Verifique a configuração nativa.');
    // Você pode querer exibir uma tela de carregamento ou erro aqui
  } else {
    console.log('Firebase App inicializado com sucesso.');
  }

  return <HomeScreen />;
};

export default App;