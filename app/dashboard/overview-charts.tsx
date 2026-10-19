"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type WeeklyPoint = { week: string; fillRate: number | null; classes: number };
export type DepartmentPoint = { department: string; fillRate: number; classes: number };

const trendConfig = {
  fillRate: { label: "Fill rate", color: "var(--chart-1)" },
} satisfies ChartConfig;

const departmentConfig = {
  fillRate: { label: "Fill rate", color: "var(--chart-1)" },
} satisfies ChartConfig;

function percent(value: unknown): string {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "—";
}

export function WeeklyFillRateChart({ data }: { data: WeeklyPoint[] }) {
  return (
    <ChartContainer config={trendConfig} className="aspect-auto h-[240px] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillRateGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-fillRate)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--color-fillRate)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis
          width={40}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value}%`}
          domain={[0, "auto"]}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(label, payload) => {
                const classes = (payload?.[0]?.payload as WeeklyPoint | undefined)?.classes;
                return `Week of ${label}${classes != null ? ` · ${classes} classes` : ""}`;
              }}
              formatter={(value) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">Fill rate</span>
                  <span className="font-mono font-medium tabular-nums">{percent(value)}</span>
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="fillRate"
          type="monotone"
          stroke="var(--color-fillRate)"
          strokeWidth={2}
          fill="url(#fillRateGradient)"
          connectNulls
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function DepartmentFillRateChart({ data }: { data: DepartmentPoint[] }) {
  return (
    <ChartContainer
      config={departmentConfig}
      className="aspect-auto w-full"
      style={{ height: Math.max(160, data.length * 44 + 24) }}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 48, top: 0, bottom: 0 }}>
        <XAxis type="number" hide domain={[0, 100]} />
        <YAxis
          type="category"
          dataKey="department"
          width={150}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <span className="flex w-full flex-col gap-0.5">
                  <span className="font-medium">{(item.payload as DepartmentPoint).department}</span>
                  <span className="text-muted-foreground">
                    {percent(value)} full · {(item.payload as DepartmentPoint).classes} classes
                  </span>
                </span>
              )}
            />
          }
        />
        <Bar dataKey="fillRate" fill="var(--color-fillRate)" radius={4} barSize={20}>
          <LabelList
            dataKey="fillRate"
            position="right"
            className="fill-foreground"
            fontSize={12}
            formatter={(value: unknown) => percent(value)}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
