import type { Meta, StoryObj } from '@storybook/react-vite';

import FileViewer from './FileViewer';

// The story imports the viewer itself, not the lazy wrapper the app uses: the wrapper only adds next/dynamic.
const meta = {
    title: 'Files/FileViewer',
    component: FileViewer,
    // required by the type; every story passes its own file
    args: { identifier: 'libre-copy' }
} satisfies Meta<typeof FileViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

// A drawing built in the story and encoded like a stored file (raw base64), so no file or network is needed.
const IMAGE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">' +
    '<rect x="8" y="8" width="304" height="184" rx="12" fill="none" stroke="currentColor" stroke-width="4"/>' +
    '<rect x="32" y="32" width="96" height="64" fill="none" stroke="currentColor" stroke-width="4"/>' +
    '<path d="M152 48h128M152 80h96M32 128h248M32 160h160" stroke="currentColor" stroke-width="6"/>' +
    '</svg>';
const IMAGE = btoa(IMAGE_SVG);

/** An image is shown in place, with a download button. The alt text is the file's identifier. */
export const Image: Story = {
    args: { file: IMAGE, identifier: 'libre-copy', contentType: 'image/svg+xml' }
};

/** Anything that is neither a PDF nor an image is offered as a download. */
export const OtherFile: Story = {
    args: { file: btoa('plate,owner\nETH-ABC-7788,Sample owner\n'), identifier: 'vehicles', contentType: 'text/csv' }
};

export const NoFile: Story = {
    args: { file: null, identifier: 'libre-copy' }
};
