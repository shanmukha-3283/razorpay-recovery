import { Link, createFileRoute } from "@tanstack/react-router";
import { Play, RefreshCw } from "lucide-react";
import {
  useManualRecovery,
  useSubscription,
  useSubscriptionSync,
} from "@/service/hooks";
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
import { getAttemptInsight } from "@/lib/attemptDetails";

export const Route = createFileRoute("/subscriptions/$id")({
  component: SubscriptionDetailPage,
});

function SubscriptionDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useSubscription(id);
  const syncMutation = useSubscriptionSync();
  const recoverMutation = useManualRecovery();

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data)
    return <p className="text-muted-foreground">Subscription not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/subscriptions">← Back</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {data.razorpaySubscriptionId}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.customerName ?? "No name"} ·{" "}
            {data.customerEmail ?? data.customerContact ?? "No contact"} · Plan{" "}
            {data.planId ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge>{data.status}</Badge>
          <Button
            variant="default"
            size="sm"
            onClick={() => recoverMutation.mutate({ id })}
            disabled={recoverMutation.isPending}
          >
            <Play className="size-4" />
            {recoverMutation.isPending ? "Scheduling…" : "Retry recovery now"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate(id)}
            disabled={syncMutation.isPending}
          >
            <RefreshCw
              className={
                syncMutation.isPending ? "size-4 animate-spin" : "size-4"
              }
            />
            {syncMutation.isPending ? "Syncing…" : "Sync from Razorpay"}
          </Button>
        </div>
      </div>
      {recoverMutation.isSuccess && (
        <p className="text-sm text-muted-foreground">
          Recovery attempt #{recoverMutation.data.data.attemptNumber} scheduled
          {recoverMutation.data.data.scheduledFor
            ? ` for ${formatDateTime(recoverMutation.data.data.scheduledFor)}`
            : ""}
          .
        </p>
      )}
      {recoverMutation.isError && (
        <p className="text-sm text-destructive">
          {recoverMutation.error.message}
        </p>
      )}

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
                <TableHead>Invoice ID</TableHead>
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
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No payments.
                  </TableCell>
                </TableRow>
              ) : (
                data.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">
                      {p.razorpayPaymentId}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.invoiceId ?? "—"}
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
                <TableHead>Razorpay</TableHead>
                <TableHead>Next attempt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recoveryAttempts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No recovery attempts.
                  </TableCell>
                </TableRow>
              ) : (
                data.recoveryAttempts.map((r) => {
                  const details = (r.details ?? {}) as {
                    razorpay?: {
                      action?: string;
                      success?: boolean;
                      shortUrl?: string | null;
                      error?: string | null;
                    };
                  };
                  const rz = details.razorpay;
                  const insight = getAttemptInsight(r.details);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>#{r.attemptNumber}</TableCell>
                      <TableCell>
                        <div>{r.action}</div>
                        {(insight.failureCategory || insight.reason) && (
                          <div className="mt-1 space-y-1">
                            {insight.failureCategory && (
                              <Badge variant="secondary">
                                {insight.failureCategory}
                              </Badge>
                            )}
                            {insight.reason && (
                              <p className="text-xs text-muted-foreground">
                                {insight.reason}
                              </p>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "destructive" : "warning"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatINR(r.amount)}</TableCell>
                      <TableCell className="text-xs">
                        {rz ? (
                          <>
                            <span className="font-mono">{rz.action ?? "razorpay"}</span>{" "}
                            {rz.success ? (
                              rz.shortUrl ? (
                                <a
                                  href={rz.shortUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline"
                                >
                                  open
                                </a>
                              ) : (
                                <span className="text-muted-foreground">ok</span>
                              )
                            ) : (
                              <span className="text-destructive">{rz.error ?? "failed"}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{formatDateTime(r.nextAttemptAt)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
