import { createProduct } from "../actions";

const input = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "text-sm font-medium";

export default async function NewProductPage(props: PageProps<"/app/catalogue/new">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">New product</h1>
      <p className="mt-1 text-sm text-zinc-500">Fill this in once. Publish it to any channel from the product page.</p>
      {error ? (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100">{error}</p>
      ) : null}
      <form action={createProduct} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className={label} htmlFor="title">
            Title
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={80}
            className={input}
            placeholder="Nike Air Max 90 UK 9 white"
          />
          <span className="text-xs text-zinc-500">Up to 80 characters, eBay's limit.</span>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className={label} htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={5}
            className={input}
            placeholder="Condition, size, what is included."
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="price">
            Price, £
          </label>
          <input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            required
            className={input}
            placeholder="45.00"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="quantity">
            Quantity in stock
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            defaultValue={1}
            required
            className={input}
          />
          <span className="text-xs text-zinc-500">1 makes it a unique item. More makes it stocked.</span>
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="condition">
            Condition
          </label>
          <select id="condition" name="condition" className={input} defaultValue="used_very_good">
            <option value="new">New</option>
            <option value="new_other">New, other</option>
            <option value="refurbished">Refurbished</option>
            <option value="used_like_new">Used, like new</option>
            <option value="used_very_good">Used, very good</option>
            <option value="used_good">Used, good</option>
            <option value="used_acceptable">Used, acceptable</option>
            <option value="for_parts">For parts</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="brand">
            Brand
          </label>
          <input id="brand" name="brand" maxLength={65} className={input} placeholder="Nike" />
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="cost">
            Cost price, £ (optional)
          </label>
          <input id="cost" name="cost" type="number" step="0.01" min="0" className={input} placeholder="20.00" />
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="sku">
            SKU (optional)
          </label>
          <input id="sku" name="sku" maxLength={80} className={input} placeholder="Left blank, one is generated" />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className={label} htmlFor="photos">
            Photo URLs, one per line (optional for now)
          </label>
          <textarea id="photos" name="photos" rows={3} className={input} placeholder="https://..." />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Save product
          </button>
        </div>
      </form>
    </div>
  );
}
