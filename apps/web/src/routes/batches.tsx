import { useState } from "react";
import { Link, Outlet, createFileRoute, useMatch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useBatches, useCloseBatch, useCreateBatch } from "@/service/hooks";
import type { Batch } from "@/lib/types";
import { formatDateTime, formatINR } from "@/lib/utils";

export const Route = createFileRoute("/batches")({
  component: BatchesPage,
});

const DOMAINS = ["subscription", "checkout", "receivable"];

function BatchesPage() {
  const [page, setPage] = useState(1);
  const detailMatch = useMatch({
    from: "/batches/$id",
    shouldThrow: false,
  });
  const { data, isLoading } = useBatches({ page: String(page) });
  const createMutation = useCreateBatch();
  const closeMutation = useCloseBatch();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState(DOMAINS[0]);

  const columns: ColumnDef<Batch, unknown>[] = [
    {
      header: "Batch",
      accessorKey: "name",
      cell: ({ row }) => (
        <Button variant="link" className="px-0" asChild>
          <Link to="/batches/$id" params={{ id: row.original.id }}>
            {row.original.name}
          </Link>
        </Button>
      ),
    },
    { header: "Domain", accessorKey: "domain" },
    {
      header: "Status",
      accessorKey: "status",
      cell: ({ getValue }) => (
        <Badge variant={getValue() === "open" ? "success" : "secondary"}>
          {getValue() as string}
        </Badge>
      ),
    },
    {
      header: "Touched",
      accessorKey: "touchedOwners",
      cell: ({ getValue }) => getValue() as number,
    },
    {
      header: "Recovered",
      accessorKey: "recoveredOwners",
      cell: ({ row }) =>
        `${row.original.recoveredOwners}/${row.original.touchedOwners}`,
    },
    {
      header: "Recovered $",
      accessorKey: "recoveredAmount",
      cell: ({ getValue }) => formatINR(getValue() as number | null),
    },
    {
      header: "Rate",
      accessorKey: "recoveryRate",
      cell: ({ getValue }) =>
        `${Math.round((getValue() as number) * 100)}%`,
    },
    {
      header: "",
      accessorKey: "id",
      cell: ({ row }) =>
        row.original.status === "open" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={closeMutation.isPending}
            onClick={() => closeMutation.mutate(row.original.id)}
          >
            Close
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(row.original.closedAt)}
          </span>
        ),
    },
  ];

  // Nested detail route (/batches/$id) renders through this
  // component's Outlet — show only the detail when it matches.
  if (detailMatch) {
    return (
      <div className="space-y-6">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recovery Batches</h1>
        <p className="text-sm text-muted-foreground">
          Measured recovered money and recovery rate per cohort
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New batch</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="week-36-promo"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Domain</label>
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: name.trim(), domain })}
            >
              {createMutation.isPending ? "Creating…" : "Create batch"}
            </Button>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {createMutation.error.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} batches`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<Batch>
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
