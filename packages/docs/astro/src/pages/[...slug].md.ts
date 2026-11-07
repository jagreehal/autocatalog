// Every page is also published as raw Markdown at <url>.md, and each page's
// <head> points here with rel="alternate". Built once per document.
import { docTwinRoute } from '../doc-twin';
import { docPaths } from '../paths';

export const getStaticPaths = docPaths;

export const GET = docTwinRoute;
