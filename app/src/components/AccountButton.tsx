import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getStoredUser, logoutAccount } from "@/lib/auth";

export default function AccountButton({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser());

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
        {user.username}
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
