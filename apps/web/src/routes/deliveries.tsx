import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeliveries } from "@/service/hooks";
import type { Delivery } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/deliveries")({
  component: DeliveriesPage,
});

const statusVariant = (s: string) =>
  s === "sent"
    ? "success"
    : s === "failed"
    ? "destructive"
    : s === "skipped"
    ? "secondary"
    : "warning";

function DeliveriesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const { data, isLoading } = useDeliveries({
    page: String(page),
    ...(status ? { status } : {}),
  });

  const columns: ColumnDef<Delivery, unknown>[] = [
    {
      header: "Subscription",
      accessorKey: "razorpaySubscriptionId",
      cell: ({ getValue }) => (getValue() as string) ?? "—",
    },
    { header: "Channel", accessorKey: "channel" },
    {
      header: "Recipient",
      accessorKey: "toEmail",
      cell: ({ getValue }) => (getValue() as string) ?? "—",
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: ({ getValue }) => (
        <Badge variant={statusVariant(getValue() as string)}>
          {getValue() as string}
        </Badge>
      ),
    },
    {
      header: "Provider",
      accessorKey: "providerMessageId",
      cell: ({ getValue }) =>
        (getValue() as string) ? (
          <span className="font-mono text-xs">{(getValue() as string).slice(0, 12)}…</span>
        ) : (
          "—"
        ),
    },
    {
      header: "Error",
      accessorKey: "error",
      cell: ({ getValue }) =>
        (getValue() as string | null) ? (
          <span className="text-xs text-destructive">{getValue() as string}</span>
        ) : (
          "—"
        ),
    },
    {
      header: "Sent",
      accessorKey: "sentAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string | null),
    },
    {
      header: "Created",
      accessorKey: "createdAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deliveries</h1>
        <p className="text-sm text-muted-foreground">
          Outbound recovery messages sent to customers
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Status:</label>
        {["sent", "failed", "skipped", "queued"].map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(status === s ? undefined : s);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
              status === s
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} deliveries`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<Delivery>
            columns={columns}
            data={data?.data ?? []}
            meta={data?.meta}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
