# Licensing brief

Prepared for review by counsel before any commercial use of this dataset.
**Nothing here is legal advice.** It records what each upstream source
publishes about its own terms, and what the code does about it, so that a
lawyer can start from facts rather than from reading the codebase.

## What is being sold

Not the raw upstream data — an integrated, normalised, deduplicated dataset
covering 826 space organisations, joined across five sources and delivered as
JSON. The engineering (entity resolution, name normalisation, provenance
tracking, licence tiering) is original work. The underlying facts are not.

## Sources and their published terms

| Source | Licence | Attribution | Share-alike | In the paid tier? |
| --- | --- | --- | --- | --- |
| Wikidata | CC0 1.0 | No | No | Yes |
| USAspending.gov | US federal work, 17 U.S.C. §105 | No | No | Yes |
| SEC EDGAR | US federal work, 17 U.S.C. §105 | No | No | Yes |
| Natural Earth | Public domain (explicit release) | No | No | Yes |
| ISO 3166-1 codes | Facts | No | No | Yes |
| Wikipedia | CC BY-SA 4.0 | **Yes** | **Yes** | **No** |
| Launch Library 2 | CC BY 4.0 + 15 req/hour cap | **Yes** | No | **No** |

## How the split is enforced

Every record carries a `provenance` map of `field → source`.
`scripts/lib/licensing.mjs` is the single place where each source declares
`redistributable: true | false`. The build emits two artifacts:

- `data/organisations.json` — everything, used by the public site only
- `data/organisations.open.json` — produced by deleting every field whose
  source is not redistributable

`scripts/validate.mjs` fails the build if any restricted-source field appears
in the open artifact, reported as `LICENCE LEAK`. This check has been verified
to fire by deliberately injecting a Wikipedia-sourced field.

## Questions for counsel

1. **Is the open tier actually clean?** It contains only CC0 and US federal
   works. The intended conclusion is that it can be sold, sublicensed and
   redistributed with no attribution or share-alike obligation. Confirm.

2. **Does share-alike reach the integrated dataset?** In the US, facts are not
   copyrightable (*Feist Publications v. Rural Telephone Service*, 499 U.S.
   340). The build therefore treats Wikipedia-derived **prose** (`summary`) as
   protected and excludes it, while treating dates, headquarters and capability
   booleans as unprotectable facts. Is that line correct, and does it survive
   the argument that the selection and arrangement of those facts is itself
   creative?

3. **EU database rights.** The *sui generis* right (Directive 96/9/EC) protects
   substantial investment in obtaining and verifying a database, independent of
   copyright, and has no US equivalent. Does supplying EU customers change the
   analysis for the Wikipedia-derived layer?

4. **Launch Library 2.** Free access is capped at 15 requests/hour and licensed
   CC BY 4.0. The data is currently excluded from the open tier and cached
   locally. Is a commercial agreement with The Space Devs required before it
   can appear in a paid product at all, even with attribution?

5. **US federal works and third-party content.** 17 U.S.C. §105 denies
   copyright to US government works, but government databases can contain
   contractor-supplied material. Is contract and filing data from USAspending
   and EDGAR unqualifiedly free to redistribute?

6. **Trade marks.** Records include organisation names and logo URLs
   (`logo`, `thumbnail`) pointing at Wikimedia Commons. Names and logos are
   trade marks regardless of the image licence. Is nominative use in a
   reference dataset safe, and should logos be dropped from the paid tier?

7. **Accuracy disclaimers.** The data is scraped and machine-joined. Some
   entries are correct but misleading without context — Tesla appears because
   it manufactured the Falcon Heavy Roadster. What warranty disclaimer and
   limitation of liability should the terms of sale carry?

## Known data-quality caveats worth disclosing to customers

- Country is resolved from Wikidata `P17`, falling back to the headquarters'
  country and then to the nationality adjective in the article lead. It is an
  inference, not an authoritative registration.
- Workforce and revenue figures are whole-organisation. Diversified
  manufacturers (Boeing, Airbus, Toyota) report company-wide totals, not space
  staff.
- Budgets carry the year they were reported and are not inflation-adjusted.
- `spacecraftCount` counts hardware with a recorded launch date in Wikidata; it
  undercounts operators whose fleets are not itemised there.
- Capability flags mean *demonstrated*, from Wikipedia's tables. A flight
  record of `(0/1)` — flown and failed — does not earn the capability.

## Attribution required for the full tier

If `organisations.json` (rather than the open tier) is redistributed:

> Contains information from Wikipedia, licensed CC BY-SA 4.0, and from Launch
> Library 2 by The Space Devs, licensed CC BY 4.0. Boundaries from Natural
> Earth. Structured data from Wikidata (CC0).
