// Must fire only-the-pdf-worker-reaches-chrome: nothing but the PDF worker loads Chrome.
import puppeteer from 'puppeteer-core';

export const launch = puppeteer.launch;
