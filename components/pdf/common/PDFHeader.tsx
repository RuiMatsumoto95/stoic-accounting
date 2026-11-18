import { View, Text } from '@react-pdf/renderer'
import { styles } from './PDFStyles'

type Props = {
  title: string
  periodName: string
}

export function PDFHeader({ title, periodName }: Props) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      <Text style={styles.headerPeriod}>{periodName}</Text>
    </View>
  )
}
