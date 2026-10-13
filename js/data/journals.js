/* LitDigest — js/data/journals.js
 * Curated starter list of major journals, grouped by field, plus common
 * arXiv categories for preprint feeds.
 * Exposed as window.JOURNAL_STARTER_GROUPS and window.ARXIV_CATEGORY_GROUPS.
 *
 * Every journal below was verified against a live registry (title + ISSN +
 * publisher checked via the Crossref journals API and OpenAlex sources data;
 * verification date 2026-10). ISSN lists contain the print ISSN first —
 * that is the identifier used for OpenAlex `primary_location.source.issn`
 * filtering — followed by the electronic ISSN where one exists.
 *
 * SCHEMA — add journals by appending an object with this shape:
 * {
 *   abbr:      string    short label shown in compact UI, e.g. 'AMJ'
 *   name:      string    official journal title as registered
 *   issns:     string[]  [print ISSN, electronic ISSN?]
 *   publisher: string
 * }
 */
(function (global) {
  'use strict';

  global.JOURNAL_STARTER_GROUPS = [
    {
      field: 'Management & Strategy',
      journals: [
        { abbr: 'AMJ',     name: 'Academy of Management Journal',   issns: ['0001-4273', '1948-0989'], publisher: 'Academy of Management' },
        { abbr: 'AMR',     name: 'Academy of Management Review',    issns: ['0363-7425', '1930-3807'], publisher: 'Academy of Management' },
        { abbr: 'ASQ',     name: 'Administrative Science Quarterly', issns: ['0001-8392', '1930-3815'], publisher: 'SAGE Publications' },
        { abbr: 'OrgSci',  name: 'Organization Science',            issns: ['1047-7039', '1526-5455'], publisher: 'INFORMS' },
        { abbr: 'MgmtSci', name: 'Management Science',              issns: ['0025-1909', '1526-5501'], publisher: 'INFORMS' },
        { abbr: 'SMJ',     name: 'Strategic Management Journal',    issns: ['0143-2095', '1097-0266'], publisher: 'Wiley' },
        { abbr: 'JoM',     name: 'Journal of Management',           issns: ['0149-2063', '1557-1211'], publisher: 'SAGE Publications' },
        { abbr: 'JAP',     name: 'Journal of Applied Psychology',   issns: ['0021-9010', '1939-1854'], publisher: 'American Psychological Association' }
      ]
    },
    {
      field: 'Entrepreneurship',
      journals: [
        { abbr: 'JBV', name: 'Journal of Business Venturing',          issns: ['0883-9026'],                   publisher: 'Elsevier' },
        { abbr: 'ETP', name: 'Entrepreneurship Theory and Practice',   issns: ['1042-2587', '1540-6520'],      publisher: 'SAGE Publications' }
      ]
    },
    {
      field: 'International Business',
      journals: [
        { abbr: 'JIBS', name: 'Journal of International Business Studies', issns: ['0047-2506', '1478-6990'], publisher: 'Springer (Palgrave Macmillan)' }
      ]
    },
    {
      field: 'Marketing',
      journals: [
        { abbr: 'JM',  name: 'Journal of Marketing',         issns: ['0022-2429', '1547-7185'], publisher: 'SAGE Publications' },
        { abbr: 'JMR', name: 'Journal of Marketing Research', issns: ['0022-2437', '1547-7193'], publisher: 'SAGE Publications' },
        { abbr: 'JCR', name: 'Journal of Consumer Research',  issns: ['0093-5301', '1537-5277'], publisher: 'Oxford University Press' }
      ]
    },
    {
      field: 'Information Systems',
      journals: [
        { abbr: 'MISQ', name: 'MIS Quarterly',              issns: ['0276-7783', '2162-9730'], publisher: 'MIS Quarterly / MIS Research Center' },
        { abbr: 'ISR',  name: 'Information Systems Research', issns: ['1047-7047', '1526-5536'], publisher: 'INFORMS' }
      ]
    },
    {
      field: 'Accounting',
      journals: [
        { abbr: 'AccRev', name: 'The Accounting Review', issns: ['0001-4826', '1558-7967'], publisher: 'American Accounting Association' }
      ]
    },
    {
      field: 'Finance',
      journals: [
        { abbr: 'JF',  name: 'The Journal of Finance',          issns: ['0022-1082', '1540-6261'], publisher: 'Wiley (American Finance Association)' },
        { abbr: 'JFE', name: 'Journal of Financial Economics',  issns: ['0304-405X'],              publisher: 'Elsevier' }
      ]
    },
    {
      field: 'Economics',
      journals: [
        { abbr: 'RAND', name: 'The RAND Journal of Economics', issns: ['0741-6261', '1756-2171'], publisher: 'Wiley (RAND Corporation)' }
      ]
    }
  ];

  /* Common arXiv categories relevant to social-science / business research,
   * grouped for the picker. Codes are official arXiv category identifiers. */
  global.ARXIV_CATEGORY_GROUPS = [
    {
      field: 'Economics',
      cats: [
        { code: 'econ.GN', label: 'econ.GN — General Economics' },
        { code: 'econ.TH', label: 'econ.TH — Theoretical Economics' },
        { code: 'econ.EM', label: 'econ.EM — Econometrics' }
      ]
    },
    {
      field: 'Computer Science / AI',
      cats: [
        { code: 'cs.CL', label: 'cs.CL — Computation and Language' },
        { code: 'cs.LG', label: 'cs.LG — Machine Learning' },
        { code: 'cs.CY', label: 'cs.CY — Computers and Society' },
        { code: 'cs.IR', label: 'cs.IR — Information Retrieval' }
      ]
    },
    {
      field: 'Statistics & Methods',
      cats: [
        { code: 'stat.ML', label: 'stat.ML — Machine Learning (Statistics)' },
        { code: 'stat.ME', label: 'stat.ME — Methodology' },
        { code: 'stat.AP', label: 'stat.AP — Applications' }
      ]
    },
    {
      field: 'Finance & Complex Systems',
      cats: [
        { code: 'q-fin.EC', label: 'q-fin.EC — Economics (Quantitative Finance)' },
        { code: 'q-fin.GN', label: 'q-fin.GN — General Finance' },
        { code: 'physics.soc-ph', label: 'physics.soc-ph — Physics and Society' }
      ]
    }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
