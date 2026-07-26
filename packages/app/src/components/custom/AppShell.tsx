import { Link } from "@tanstack/react-router";
import { ConnectedUsersCount } from "~/components/custom/ConnectedUsersCount";
import { Logo } from "~/components/custom/Logo";
import { UserActions } from "~/components/custom/UserActions";

/** The chrome shared by the app's two protected shells: the topbar (brand +
 *  online count + user actions) above a scrolling content area.
 *
 *  Navigation is a slot, not a feature of the shell — Teams (`/home`) is the
 *  app itself and passes none, while the secondary area (`/play`) passes its
 *  own section links. Each caller keeps its `to`s literal so TanStack's typed
 *  links still check them. */
export function AppShell({
  nav,
  menu,
  children,
}: {
  /** Desktop section links, rendered after the logo. */
  nav?: React.ReactNode;
  /** Leading slot for a mobile nav trigger, rendered before the logo. */
  menu?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="app-topbar flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3 sm:gap-4 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          {menu}
          {/* Always home = Teams; this is also the way back out of /play. */}
          <Link to="/home" className="shrink-0">
            <Logo size="sm" textClassName="hidden sm:inline" />
          </Link>
          {nav}
        </div>
        <div className="flex items-center justify-end gap-1 sm:gap-2">
          <ConnectedUsersCount />
          <UserActions />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
