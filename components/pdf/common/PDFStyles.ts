import { StyleSheet } from '@react-pdf/renderer'

export const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    paddingTop: 30,
    paddingBottom: 30,
    paddingHorizontal: 30,
    color: '#111',
  },
  header: {
    marginBottom: 12,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  headerPeriod: {
    fontSize: 9,
    color: '#555',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    fontSize: 8,
    color: '#888',
  },
  table: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#ddd',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
  },
  subtotalRow: {
    flexDirection: 'row',
    backgroundColor: '#fafafa',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderTopWidth: 0.5,
    borderTopColor: '#bbb',
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
  },
  totalRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#333',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  labelCell: {
    flex: 1,
  },
  amountCell: {
    width: 80,
    textAlign: 'right',
  },
  boldText: {
    fontWeight: 'bold',
  },
  indentLabel: {
    flex: 1,
    paddingLeft: 12,
  },
})
