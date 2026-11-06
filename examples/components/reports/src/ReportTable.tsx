export interface ReportTableProps {
  /** The rows to show, one per settled payment. */
  rows: Array<{ reference: string; amount: string }>;
}

/** The settlement report: one row per payment. */
export function ReportTable({ rows }: ReportTableProps) {
  return (
    <table>
      <tbody>
        {rows.map(({ reference, amount }) => (
          <tr key={reference}>
            <td>{reference}</td>
            <td>{amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
