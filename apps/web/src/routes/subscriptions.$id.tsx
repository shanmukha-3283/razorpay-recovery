import { Link, createFileRoute } from "@tanstack/react-router";
import { useSubscription } from "@/service/hooks";
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

export const Route = createFileRoute("/subscriptions/$id")({
  component: SubscriptionDetailPage,
});

function SubscriptionDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useSubscription(id);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data)
    return <p className="text-muted-foreground">Subscription not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/subscriptions">← Back</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {data.razorpaySubscriptionId}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.customerEmail ?? data.customerContact ?? "No customer"} · Plan{" "}
            {data.planId ?? "—"}
          </p>
        </div>
        <Badge>{data.status}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Current period
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {formatDateTime(data.currentStart)} → {formatDateTime(data.currentEnd)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Paid / Total
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {data.paidCount}/{data.totalCount ?? "∞"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Created
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {formatDateTime(data.createdAt)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment ID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No payments.
                  </TableCell>
                </TableRow>
              ) : (
                data.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">
                      {p.razorpayPaymentId}
                    </TableCell>
                    <TableCell>{formatINR(p.amount, p.currency ?? "INR")}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "captured" ? "success" : p.status === "failed" ? "destructive" : "secondary"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.method ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {p.errorDescription ?? p.errorCode ?? "—"}
                    </TableCell>
                    <TableCell>{formatDateTime(p.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recovery attempts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attempt</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Next attempt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recoveryAttempts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No recovery attempts.
                  </TableCell>
                </TableRow>
              ) : (
                data.recoveryAttempts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>#{r.attemptNumber}</TableCell>
                    <TableCell>{r.action}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "destructive" : "warning"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatINR(r.amount)}</TableCell>
                    <TableCell>{formatDateTime(r.nextAttemptAt)}</TableCell>
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
