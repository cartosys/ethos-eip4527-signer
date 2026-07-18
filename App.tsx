import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { seedDefaultAccountIfNeeded } from './src/store/accountsStore';

export default function App() {
  useEffect(() => {
    seedDefaultAccountIfNeeded();
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
