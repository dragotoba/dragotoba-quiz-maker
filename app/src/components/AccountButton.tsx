import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getStoredUser, logoutAccount, type AuthUser } from "@/lib/auth";

function labelFor(user: AuthUser) {
  return user.displayName?.trim() || user.username;
}

export default function AccountButton({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser());

  useEffect(() => {
    function sync() {
      setUser(getStoredUser());
    }
    window.addEventListener("storage", sync);
    window.addEventListener("dragotoba-auth-user", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("dragotoba-auth-user", sync);
    };
  }, []);

  if (!user) {
    return (
      <Link
        to="/login"
        className={`rounded-full border border-[#2f5d76]/25 bg-white/70 px-4 py-2 text-sm font-semibold text-[#2f5d76] no-underline shadow-sm hover:bg-white hover:text-[#244a5e] ${className}`}
      >
        Log In
      </Link>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="max-w-[10rem] truncate text-sm font-semibold text-[#1c2a33]">
        {labelFor(user)}
      </span>
      <button
        type="button"
        onClick={() => {
          logoutAccount();
          setUser(null);
          navigate("/");
        }}
        className="cursor-pointer rounded-full border border-[#2f5d76]/25 bg-white/70 px-4 py-2 text-sm font-semibold text-[#2f5d76] shadow-sm hover:bg-white hover:text-[#244a5e]"
      >
        Log Out
      </button>
    </div>
  );
}
