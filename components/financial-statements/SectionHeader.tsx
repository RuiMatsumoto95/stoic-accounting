interface Props {
  label: string
  colSpan: number
}

export function SectionHeader({ label, colSpan }: Props) {
  return (
    <tr className="bg-muted/60">
      <td
        colSpan={colSpan}
        className="py-1.5 px-3 font-bold text-sm"
      >
        {label}
      </td>
    </tr>
  )
}
