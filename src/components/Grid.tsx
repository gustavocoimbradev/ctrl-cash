import React, { useState } from 'react';
import { View } from 'react-native';
import { spacing } from '../theme';

interface Props {
  children: React.ReactNode;
  /** minimum width of each column */
  minWidth?: number;
  maxColumns?: number;
  gap?: number;
}

/**
 * Grid of equal columns (1 to `maxColumns`, depending on the measured width). All
 * grids with the same container width have exactly the same columns, so
 * items from different grids line up. Items in the same row have the same height.
 */
export function Grid({ children, minWidth = 280, maxColumns = 3, gap = spacing.lg }: Props) {
  const [width, setWidth] = useState(0);
  const cols = width ? Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minWidth + gap)))) : 1;
  const itemWidth = width ? (width - gap * (cols - 1)) / cols : undefined;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {React.Children.toArray(children).map((child, i) => (
        <View key={i} style={{ width: itemWidth ?? '100%' }}>
          {child}
        </View>
      ))}
    </View>
  );
}
