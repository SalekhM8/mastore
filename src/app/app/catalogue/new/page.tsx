import { Button, Card, inputClass, labelClass, Notice, PageHeader } from "@/components/ui";
import { createProduct } from "../actions";

export default async function NewProductPage(props: PageProps<"/app/catalogue/new">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const field = (id: string, label: string, control: React.ReactNode, hint?: string, span = false) => (
    <div className={`flex flex-col gap-1 ${span ? "sm:col-span-2" : ""}`}>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      {control}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Catalogue"
        title="New product"
        description="Fill this in once. Publish it to any channel from the product page."
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Card strong>
        <form action={createProduct} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field(
            "title",
            "Title",
            <input
              id="title"
              name="title"
              required
              maxLength={80}
              className={inputClass}
              placeholder="Nike Air Max 90 UK 9 white"
            />,
            "Up to 80 characters, eBay's limit.",
            true,
          )}
          {field(
            "description",
            "Description",
            <textarea
              id="description"
              name="description"
              required
              rows={5}
              className={inputClass}
              placeholder="Condition, size, what is included."
            />,
            undefined,
            true,
          )}
          {field(
            "price",
            "Price, £",
            <input
              id="price"
              name="price"
              type="number"
              step="0.01"
              min="0.01"
              required
              className={inputClass}
              placeholder="45.00"
            />,
          )}
          {field(
            "quantity",
            "Quantity in stock",
            <input
              id="quantity"
              name="quantity"
              type="number"
              min="1"
              step="1"
              defaultValue={1}
              required
              className={inputClass}
            />,
            "1 makes it a unique item. More makes it stocked.",
          )}
          {field(
            "condition",
            "Condition",
            <select id="condition" name="condition" className={inputClass} defaultValue="used_very_good">
              <option value="new">New</option>
              <option value="new_other">New, other</option>
              <option value="refurbished">Refurbished</option>
              <option value="used_like_new">Used, like new</option>
              <option value="used_very_good">Used, very good</option>
              <option value="used_good">Used, good</option>
              <option value="used_acceptable">Used, acceptable</option>
              <option value="for_parts">For parts</option>
            </select>,
          )}
          {field(
            "brand",
            "Brand",
            <input id="brand" name="brand" maxLength={65} className={inputClass} placeholder="Nike" />,
          )}
          {field(
            "cost",
            "Cost price, £ (optional)",
            <input
              id="cost"
              name="cost"
              type="number"
              step="0.01"
              min="0"
              className={inputClass}
              placeholder="20.00"
            />,
          )}
          {field(
            "sku",
            "SKU (optional)",
            <input
              id="sku"
              name="sku"
              maxLength={80}
              className={inputClass}
              placeholder="Left blank, one is generated"
            />,
          )}
          {field(
            "photos",
            "Photo URLs, one per line (optional for now)",
            <textarea id="photos" name="photos" rows={3} className={inputClass} placeholder="https://..." />,
            undefined,
            true,
          )}
          <div className="sm:col-span-2">
            <Button type="submit">Save product</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
