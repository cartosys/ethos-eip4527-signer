import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '../theme';
import type { RootStackParamList } from './types';
import { ScannerScreen } from '../screens/ScannerScreen';
import { TxReviewScreen } from '../screens/TxReviewScreen';
import { SigningResultScreen } from '../screens/SigningResultScreen';
import { SimulatorScreen } from '../screens/SimulatorScreen';
import { AccountsListScreen } from '../screens/AccountsListScreen';
import { AccountFormScreen } from '../screens/AccountFormScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.bgDeep },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Scanner"       component={ScannerScreen} />
        <Stack.Screen name="TxReview"      component={TxReviewScreen} />
        <Stack.Screen
          name="SigningResult"
          component={SigningResultScreen}
          options={{ gestureEnabled: false }}
        />
        <Stack.Screen name="Simulator"     component={SimulatorScreen} />
        <Stack.Screen name="Accounts"      component={AccountsListScreen} />
        <Stack.Screen name="AccountForm"   component={AccountFormScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
