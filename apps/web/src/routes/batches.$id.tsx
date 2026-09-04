import { Link, createFileRoute } from "@tanstack/react-router";
import { useBatch, useCloseBatch } from "@/service/hooks";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatINR } from "@/lib/utils";

export const Route = createFileRoute("/batches/$id")({
  component: BatchDetailPage,
});

function BatchDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useBatch(id);
  const closeMutation = useCloseBatch();

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-muted-foreground">Batch not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/batches">← Back</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data.domain} · {data.touchedOwners} touched ·{" "}
            {data.recoveredOwners} recovered ({Math.round(data.recoveryRate * 100)}
            %) · {formatINR(data.recoveredAmount)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={data.status === "open" ? "success" : "secondary"}>
            {data.status}
          </Badge>
          {data.status === "open" && (
            <Button
              variant="outline"
              size="sm"
              disabled={closeMutation.isPending}
              onClick={() => closeMutation.mutate(id)}
            >
              {closeMutation.isPending ? "Closing…" : "Close batch"}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Member attempts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attempt</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.attempts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No attempts tagged yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.attempts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>#{r.attemptNumber}</TableCell>
                    <TableCell>{r.action}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "destructive" : "warning"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatINR(r.amount)}</TableCell>
                    <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
