# Invoicing

The Money card already computes what a job is worth. It does not produce
anything Mike can send. This adds the document: a numbered invoice, issued
under the company's own name and HST number, delivered as a PDF.

## What an invoice is here

**A frozen record, not a live view of the job.** The Money card recomputes
from the current measurements every time it renders — correct for the card,
wrong for a document that has already left the building. An invoice therefore
stores its own line items, its own totals, its own HST rate, and its own copy
of the issuer's name and address. Editing a window next week must not restate
an invoice sent last week.

That is the same instinct as export history (snapshot the input, never the
bytes) applied one step further: an export is regenerated from its snapshot,
an invoice is *displayed* from its snapshot, because the money on it is a
claim someone has already acted on.

## Lifecycle

`draft` → `sent` → `paid`.

Only a draft is editable or deletable. Marking sent freezes the lines, the
totals and the issuer block; marking paid stamps the date. A draft
re-snapshots the issuer on every save, so fixing a typo in the company address
repairs unsent drafts and leaves history alone. Sent can be reopened to draft
deliberately, with a warning — a correction to a document already in Elite's
inbox is a real-world event, not an undo.

## Numbering

`PREFIX-0001`, incrementing from the highest number already on the device.
The field is editable, because the number is Mike's to choose and because two
phones drafting offline can reach for the same one. A duplicate is flagged in
the editor rather than prevented: the app cannot know which of the two was
actually sent.

## Legal content

A Canadian invoice over $30 must carry the supplier's GST/HST registration
number for the customer to claim an input tax credit. Elite's bookkeeper will
ask for it. The number, the legal name, the address and the payment
instructions live once in company settings (`companies.billing`) and are
copied onto each invoice as it is issued.

## Delivery

PDF, generated on the device.

Not .xlsx: a spreadsheet is the factory's order format, not a document you
send an accounts-payable department, and nobody on this crew has Excel. Not
server-rendered: the phone is regularly on a job site with no signal, and the
whole app is built to work there.

The generator is hand-written (`lib/invoice/pdf.ts`) rather than a library.
An invoice is text, rules and one logo — the entire feature is a few hundred
lines of pure function, it adds nothing to the bundle, and its output is
bytes, which means it can be tested exactly.

## Prefill

"New invoice" seeds its lines from the same `computeInvoice` the card shows,
then hands them over as ordinary editable rows. Quantities stay editable so a
floor-by-floor progress invoice is a matter of typing the count actually being
billed, and `+ Add line` covers everything the job model does not know about
(materials, parking, an extra trip).
