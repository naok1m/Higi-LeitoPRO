import * as React from "react"

import { cn } from "@/lib/utils"

const Table = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<"table">} props @param {React.ForwardedRef<HTMLTableElement>} ref */
  ({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props} />
  </div>
  ))
Table.displayName = "Table"

const TableHeader = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<"thead">} props @param {React.ForwardedRef<HTMLTableSectionElement>} ref */
  ({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
  ))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<"tbody">} props @param {React.ForwardedRef<HTMLTableSectionElement>} ref */
  ({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props} />
  ))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<"tfoot">} props @param {React.ForwardedRef<HTMLTableSectionElement>} ref */
  ({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props} />
  ))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<"tr">} props @param {React.ForwardedRef<HTMLTableRowElement>} ref */
  ({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props} />
  ))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef(
  /** @param {React.ThHTMLAttributes<HTMLTableCellElement>} props @param {React.ForwardedRef<HTMLTableCellElement>} ref */
  ({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props} />
  ))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef(
  /** @param {React.TdHTMLAttributes<HTMLTableCellElement>} props @param {React.ForwardedRef<HTMLTableCellElement>} ref */
  ({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props} />
  ))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<"caption">} props @param {React.ForwardedRef<HTMLTableCaptionElement>} ref */
  ({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props} />
  ))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
