import { View, Text } from '@react-pdf/renderer'
import { styles } from './PDFStyles'

export function PDFFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}
