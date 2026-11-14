// ==============================================================
// Papers as a PubMed search hands them to an agent
//
// The chat's PubMed tool asks Europe PMC, whose answer holds more than an
// agent needs and less than it should be told plainly. Each paper becomes
// a short record: title, authors, journal, year, a cut abstract, PMID, DOI,
// how often it is cited, whether it is a review, and a link. Two marks are
// added only when they apply, so an ordinary result stays short:
//
//   · retracted: the paper has been withdrawn, and is not evidence;
//   · preprint: it has not been through peer review.
//
// A paper with no title or abstract is left out: there is nothing in it to
// cite from.
//
// Pure. Published as window.HCPapers. Checked by scripts/checks/chat-papers.mjs.
// ==============================================================
(function () {
  'use strict';

  /** How much of an abstract an agent is given. */
  const ABSTRACT = 500;

  const listOf = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);

  /** Europe PMC's answer to a search as the papers an agent reads. */
  function fromEuropePmc(data) {
    const rows = data && data.resultList && Array.isArray(data.resultList.result) ? data.resultList.result : [];
    return rows.map((p) => {
      const types = listOf(p && p.pubTypeList && p.pubTypeList.pubType);
      const paper = {
        title: p.title || '',
        authors: p.authorString || '',
        journal: p.journalTitle || (p.bookOrReportDetails && p.bookOrReportDetails.publisher) || '',
        year: p.pubYear || '',
        abstract: String(p.abstractText || '').slice(0, ABSTRACT),
        pmid: p.pmid || '',
        doi: p.doi || '',
        source: p.source || '',
        citations: p.citedByCount != null ? p.citedByCount : null,
        isReview: types.some((t) => /review/i.test(t)),
        url: p.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`
          : (p.doi ? `https://doi.org/${p.doi}` : `https://europepmc.org/article/${p.source || 'MED'}/${p.id || ''}`),
      };
      if (types.some((t) => /^retracted publication$/i.test(t.trim()))) paper.retracted = true;
      if (p.source === 'PPR' || types.some((t) => /^preprint$/i.test(t.trim()))) paper.preprint = true;
      return paper;
    }).filter((x) => x.title && x.abstract);
  }

  window.HCPapers = { ABSTRACT, fromEuropePmc };
})();
