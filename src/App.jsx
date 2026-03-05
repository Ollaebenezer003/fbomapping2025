import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
// import Nav from "./utils/Nav";
import Home from "./Home";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ModalProvider } from "./context/ModalContext";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ModalProvider>
        <Router>
          {/* <Nav /> */}
          <Routes>
            <Route path="/" element={<Home />} />
          </Routes>
        </Router>
      </ModalProvider>
    </QueryClientProvider>
  );
}

export default App;
