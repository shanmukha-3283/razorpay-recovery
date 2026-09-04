import { createFileRoute } from "@tanstack/react-router";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  ReceiptText,
  AlertTriangle,
  Repeat,
  ShieldAlert,
  BadgeCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useStats, useRecovery } from "@/service/hooks";
import { getAttemptInsight } from "@/lib/attemptDetails";
import { formatINR, formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: recovery } = useRecovery({ limit: "10" });

  const chartData = (recovery?.data ?? []).map((r) => ({
    time: formatDateTime(r.createdAt).split(",")[0],
    amount: r.amount ?? 0,
  }));

  const cards = [
    {
      label: "Total Subscriptions",
      value: stats?.totalSubscriptions ?? 0,
      icon: ReceiptText,
    },
    {
      label: "Pending",
      value: stats?.pendingSubscriptions ?? 0,
      icon: AlertTriangle,
    },
    {
      label: "Halted",
      value: stats?.haltedSubscriptions ?? 0,
      icon: ShieldAlert,
    },
    {
      label: "Recovery Attempts",
      value: stats?.retriesFired ?? 0,
      icon: Repeat,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of subscription revenue recovery
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardContent className="flex items-center justify-between p-6">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="mt-1 text-3xl font-bold">
                    {statsLoading ? "…" : card.value}
                  </p>
                </div>
                <Icon className="size-8 text-muted-foreground" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recovery amounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      stroke="#16a34a"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No recovery data yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeCheck className="size-4 text-green-600" />
              Recovered value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {formatINR(stats?.totalRecoveredAmount)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Total amount recovered across all attempts
            </p>
            <div className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Failed payments</span>
                <span className="font-medium">{stats?.failedPayments ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Raw events</span>
                <span className="font-medium">{stats?.totalRawEvents ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Last recovery</span>
                <span className="font-medium">
                  {formatDateTime(stats?.lastRecoveredAt)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent recovery attempts</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/recovery">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(recovery?.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No attempts yet.</p>
            ) : (
              (recovery?.data ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {r.razorpaySubscriptionId ?? r.subscriptionId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Attempt #{r.attemptNumber} · {r.action} ·{" "}
                      {formatDateTime(r.createdAt)}
                    </p>
                    {(() => {
                      const insight = getAttemptInsight(r.details);
                      return (
                        (insight.failureCategory || insight.reason) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {insight.failureCategory && (
                              <Badge variant="secondary" className="mr-1">
                                {insight.failureCategory}
                              </Badge>
                            )}
                            {insight.reason}
                          </p>
                        )
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">
                      {formatINR(r.amount)}
                    </span>
                    <Badge
                      variant={
                        r.status === "completed"
                          ? "success"
                          : r.status === "failed"
                          ? "destructive"
                          : "warning"
                      }
                    >
                      {r.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
