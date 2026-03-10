import { withAuth } from "next-auth/middleware";

export default withAuth;

export const config = {
    // Protect everything except these paths
    matcher: ["/((?!api/auth|api/movers|api/momentum|api/penny-stocks|api/overnight-analysis|api/header-data|api/debug|api/sync|login|admin-login|register|_next/static|_next/image|favicon.ico).*)"],
};
