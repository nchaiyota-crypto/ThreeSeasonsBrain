export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        colorScheme: "light",
        background: "#f7f7f7",
        color: "#111",
        minHeight: "100vh",
      }}
    >
      {children}
    </div>
  );
}