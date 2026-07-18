import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { Colors } from '../theme';

const RETICLE_SIZE = 240;
const CORNER_LENGTH = 36;
const CORNER_WIDTH = 3;

export function ScanReticle() {
  const scanLine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(scanLine, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [scanLine]);

  const translateY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, RETICLE_SIZE - 2],
  });

  return (
    <View style={styles.reticle} pointerEvents="none">
      {/* Top-left */}
      <View style={[styles.corner, styles.topLeft]}>
        <View style={[styles.cornerH, { backgroundColor: Colors.neonCyan }]} />
        <View style={[styles.cornerV, { backgroundColor: Colors.neonCyan }]} />
      </View>
      {/* Top-right */}
      <View style={[styles.corner, styles.topRight]}>
        <View style={[styles.cornerH, { backgroundColor: Colors.neonCyan }]} />
        <View style={[styles.cornerV, styles.cornerVRight, { backgroundColor: Colors.neonCyan }]} />
      </View>
      {/* Bottom-left */}
      <View style={[styles.corner, styles.bottomLeft]}>
        <View style={[styles.cornerH, styles.cornerHBottom, { backgroundColor: Colors.neonCyan }]} />
        <View style={[styles.cornerV, { backgroundColor: Colors.neonCyan }]} />
      </View>
      {/* Bottom-right */}
      <View style={[styles.corner, styles.bottomRight]}>
        <View style={[styles.cornerH, styles.cornerHBottom, { backgroundColor: Colors.neonCyan }]} />
        <View style={[styles.cornerV, styles.cornerVRight, { backgroundColor: Colors.neonCyan }]} />
      </View>
      {/* Scan line */}
      <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  reticle: {
    width: RETICLE_SIZE,
    height: RETICLE_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_LENGTH,
    height: CORNER_LENGTH,
  },
  topLeft:     { top: 0,    left: 0 },
  topRight:    { top: 0,    right: 0 },
  bottomLeft:  { bottom: 0, left: 0 },
  bottomRight: { bottom: 0, right: 0 },
  cornerH: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CORNER_LENGTH,
    height: CORNER_WIDTH,
  },
  cornerHBottom: {
    top: undefined,
    bottom: 0,
  },
  cornerV: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CORNER_WIDTH,
    height: CORNER_LENGTH,
  },
  cornerVRight: {
    left: undefined,
    right: 0,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.neonCyan,
    opacity: 0.8,
    shadowColor: Colors.neonCyan,
    shadowRadius: 4,
    shadowOpacity: 1,
    elevation: 2,
  },
});
