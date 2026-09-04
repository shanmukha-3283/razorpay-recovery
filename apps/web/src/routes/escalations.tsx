import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAckEscalation,
  useCheckEscalationSla,
  useEscalations,
} from "@/service/hooks";
import type { Escalation } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/escalations")({
  component: EscalationsPage,
});

function isBreached(e: Escalation): boolean {
  return (
    e.status === "open" && e.slaDue !== null && new Date(e.slaDue) < new Date()
  );
}

function EscalationsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const { data, isLoading } = useEscalations({
    page: String(page),
    ...(status ? { status } : {}),
  });
  const ackMutation = useAckEscalation();
  const slaMutation = useCheckEscalationSla();

  const columns: ColumnDef<Escalation, unknown>[] = [
    {
      header: "Domain",
      accessorKey: "domain",
    },
    {
      header: "Reason",
      accessorKey: "reason",
      cell: ({ getValue }) => (
        <span className="text-xs">{(getValue() as string) ?? "—"}</span>
      ),
    },
    {
      header: "Owner",
      accessorKey: "owner",
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.status === "resolved"
              ? "success"
              : isBreached(row.original)
              ? "destructive"
              : "warning"
          }
        >
          {row.original.status}
          {isBreached(row.original) ? " · breached" : ""}
        </Badge>
      ),
    },
    {
      header: "SLA due",
      accessorKey: "slaDue",
      cell: ({ getValue }) => formatDateTime(getValue() as string | null),
    },
    {
      header: "",
      accessorKey: "id",
      cell: ({ row }) =>
        row.original.status === "open" ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={ackMutation.isPending}
              onClick={() =>
                ackMutation.mutate({ id: row.original.id, body: { status: "acked" } })
              }
            >
              Ack
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={ackMutation.isPending}
              onClick={() =>
                ackMutation.mutate({
                  id: row.original.id,
                  body: { status: "resolved" },
                })
              }
            >
              Resolve
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(row.original.updatedAt)}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Escalations</h1>
          <p className="text-sm text-muted-foreground">
            Human review queue with SLA tracking
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={slaMutation.isPending}
          onClick={() => slaMutation.mutate()}
        >
          {slaMutation.isPending ? "Checking…" : "Run SLA check"}
        </Button>
      </div>
      {slaMutation.isSuccess && (
        <p className="text-sm text-muted-foreground">
          Checked {slaMutation.data.data.checked}, breached{" "}
          {slaMutation.data.data.breached.length}.
        </p>
      )}
      <div className="flex gap-2">
        {(["open", "acked", "resolved"] as const).map((s) => (
          <Button
            key={s}
            variant={status === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatus(status === s ? undefined : s);
              setPage(1);
            }}
          >
            {s}
          </Button>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} escalations`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<Escalation>
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
