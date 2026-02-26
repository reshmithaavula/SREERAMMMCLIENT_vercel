import { withAuth } from "next-auth/middleware";

export default withAuth;

export const config = {
    // Protect everything except these paths
    matcher: ["/((?!api/auth|api/movers|api/momentum|api/header-data|login|admin-login|register|_next/static|_next/image|favicon.ico|$).*)"],
};
