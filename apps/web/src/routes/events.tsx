import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEvents } from "@/service/hooks";
import type { RawEvent } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/events")({
  component: EventsPage,
});

function EventsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useEvents({ page: String(page) });

  const columns: ColumnDef<RawEvent, unknown>[] = [
    {
      header: "Event type",
      accessorKey: "eventType",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.eventType}</span>
      ),
    },
    {
      header: "Razorpay event ID",
      accessorKey: "razorpayEventId",
      cell: ({ getValue }) => (getValue() as string) ?? "—",
    },
    {
      header: "Received",
      accessorKey: "receivedAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
    {
      header: "Processed",
      accessorKey: "processedAt",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? (
          <Badge variant="success">Yes</Badge>
        ) : (
          <Badge variant="warning">Pending</Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Raw Events</h1>
        <p className="text-sm text-muted-foreground">
          Webhook events persisted before processing
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} events`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<RawEvent>
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
