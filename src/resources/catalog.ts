import type { HttpClient } from "../http.js";
import { parseCatalog } from "../parse.js";
import type { Catalog, RequestOptions } from "../types.js";
import { readOptions } from "../validate.js";

/** The currencies, items and packs of the game. */
export class CatalogResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Active currencies, items and packs. `GET /catalog` */
  async get(options?: RequestOptions): Promise<Catalog> {
    const { signal } = readOptions(options, false, "catalog.get");
    return (await this.#http.call({ method: "GET", path: "/catalog", signal }, parseCatalog)).value;
  }
}
