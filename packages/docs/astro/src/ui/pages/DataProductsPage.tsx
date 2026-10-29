/** @jsxImportSource react */
import { Card, CardContent } from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { Icon } from '../components/Icon';

export interface DataProductsPageProps {
  products: Array<{
    name: string;
    summary?: string | undefined;
    repository: string;
    domain?: string | undefined;
    inputs: number;
    outputs: number;
    href: string;
  }>;
}

export function DataProductsPage({ products }: DataProductsPageProps) {
  if (products.length === 0) {
    return (
      <div className="not-content">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="dataProduct" />
            </EmptyMedia>
            <EmptyTitle>No data products yet</EmptyTitle>
            <EmptyDescription>
              Publish one in <code>data-products/&lt;id&gt;.md</code>, naming its inputs and outputs
              as <code>about:</code> does, and it appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content" data-wide>
      <Card>
        <CardContent>
          <Table aria-label="Data products">
            <TableHeader>
              <TableHead isRowHeader>Data product</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>Inputs</TableHead>
              <TableHead>Outputs</TableHead>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.href} id={product.href}>
                  <TableCell>
                    <a
                      href={product.href}
                      className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                    >
                      {product.name}
                    </a>
                    {product.summary && (
                      <p className="m-0 mt-1 text-muted-foreground">{product.summary}</p>
                    )}
                  </TableCell>
                  <TableCell>{product.domain}</TableCell>
                  <TableCell>{product.repository}</TableCell>
                  <TableCell>{product.inputs}</TableCell>
                  <TableCell>{product.outputs}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default DataProductsPage;
