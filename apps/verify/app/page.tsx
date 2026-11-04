import { VerifyPage } from '../src/VerifyPage';

/** The one page: Nginx serves it for every `/<token>`, and the page reads the token from the address. */
export default function Page() {
    return <VerifyPage />;
}
