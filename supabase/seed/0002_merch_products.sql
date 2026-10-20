-- Starter team store product: a truck door magnet whose QR code is the
-- buyer's affiliate link. Replace the design with your own at /admin/store.

insert into merch_products (name, description, design_svg, barcode_format, barcode_source, price_cents, vendor_name, print_specs)
values (
  'Truck Door Magnet',
  'Vehicle magnet with a QR code that credits you for every scan.',
  '<svg xmlns="http://www.w3.org/2000/svg" width="24in" height="12in" viewBox="0 0 2400 1200">
  <rect width="2400" height="1200" rx="60" fill="#ffffff"/>
  <rect width="2400" height="1200" rx="60" fill="none" stroke="#2f6b3a" stroke-width="40"/>
  <rect x="0" y="0" width="1500" height="1200" rx="60" fill="#2f6b3a"/>
  <rect x="1440" y="0" width="60" height="1200" fill="#2f6b3a"/>
  <text x="110" y="330" font-family="Arial, Helvetica, sans-serif" font-size="190" font-weight="700" fill="#ffffff">{{company}}</text>
  <text x="110" y="500" font-family="Arial, Helvetica, sans-serif" font-size="70" fill="#ffffff">{{services}}</text>
  <text x="110" y="800" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="700" fill="#ffffff">{{phone}}</text>
  <text x="110" y="980" font-family="Arial, Helvetica, sans-serif" font-size="80" fill="#d9ead3">Licensed &amp; insured</text>
  <rect id="barcode-slot" x="1640" y="170" width="620" height="620" fill="#eeeeee"/>
  <text x="1950" y="930" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="90" font-weight="700" fill="#1a1a1a">SCAN FOR A</text>
  <text x="1950" y="1040" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="90" font-weight="700" fill="#1a1a1a">FREE QUOTE</text>
</svg>',
  'qrcode',
  'affiliate',
  4500,
  null,
  '24" x 12" vehicle magnet, 30 mil, UV-laminated, rounded corners. Sold in pairs (one per door).'
);
