"use client";

export function AppFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      className="bg-[#f9fafb] border-t border-[#e5e7eb] py-3 px-6"
      style={{
        backgroundColor: "#f9fafb",
        borderTop: "1px solid #e5e7eb",
      }}
      role="contentinfo"
    >
      <div className="flex flex-col md:flex-row items-center justify-between gap-2 max-w-screen-2xl mx-auto">
        <div className="text-center md:text-left">
          <p className="text-xs text-gray-500">
            © {currentYear} Murage Foundation. All rights reserved.
          </p>
        </div>
        <div className="text-center md:text-right">
          <p className="text-xs text-gray-500">Developed by Francis Murage Muhoro</p>
        </div>
      </div>
    </footer>
  );
}
