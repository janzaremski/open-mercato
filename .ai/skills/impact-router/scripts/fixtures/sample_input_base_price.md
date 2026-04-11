Add a base price field to catalog products that flows through to sales order line items and is exposed in the API.

The field should:
- be stored on the product entity as `base_price` (decimal)
- be returned in the catalog products API response
- be readable by the sales module when calculating order line totals
- require a new ACL feature to view/edit pricing data
