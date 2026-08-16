import { BrowserRouter, Route, Routes } from "react-router-dom";
import Index from "./pages/Index";
import CreateQuiz from "./pages/CreateQuiz";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/create" element={<CreateQuiz />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
