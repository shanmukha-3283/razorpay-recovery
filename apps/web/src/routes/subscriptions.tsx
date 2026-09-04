import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSubscriptions } from "@/service/hooks";
import type { Subscription } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/subscriptions")({
  component: SubscriptionsPage,
});

const statusVariant = (status: string): "default" | "success" | "warning" | "destructive" | "secondary" | "outline" => {
  switch (status) {
    case "active":
      return "success";
    case "pending":
      return "warning";
    case "halted":
      return "destructive";
    case "cancelled":
      return "secondary";
    default:
      return "outline";
  }
};

function SubscriptionsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSubscriptions({ page: String(page) });

  const columns: ColumnDef<Subscription, unknown>[] = [
    {
      header: "Subscription",
      accessorKey: "razorpaySubscriptionId",
      cell: ({ row }) => (
        <Button variant="link" className="px-0" asChild>
          <Link to="/subscriptions/$id" params={{ id: row.original.id }}>
            {row.original.razorpaySubscriptionId}
          </Link>
        </Button>
      ),
    },
    {
      header: "Customer",
      cell: ({ row }) =>
        row.original.customerName ?? row.original.customerEmail ?? "—",
    },
    { header: "Plan", accessorKey: "planId", cell: ({ getValue }) => getValue() as string ?? "—" },
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
      header: "Paid",
      cell: ({ row }) =>
        `${row.original.paidCount}/${row.original.totalCount ?? "∞"}`,
    },
    {
      header: "Updated",
      accessorKey: "updatedAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
        <p className="text-sm text-muted-foreground">
          All subscription records ingested from Razorpay webhooks
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} subscriptions`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<Subscription>
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
