import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export default function useFacilities() {
  // return useQuery({
  //   queryKey: ["facilities"],
  //   queryFn: async () => {
  //     const res = await axios.get("http://localhost:8080/facilities");
  //     // console.log(res.data);
  //     console.log("Fetched facilities:", res.data);
  //     return res.data;
  //   },
  // });
  return useQuery({
    queryKey: ["facilities"],
    queryFn: async () => {
      try {
        const res = await axios.get(
          "http://localhost:8082/facilities?format=geojson",
        );
        // ensure res.data is always defined
        return res.data ?? [];
      } catch (err) {
        console.error("Error fetching facilities:", err);
        return []; // return empty array instead of undefined
      }
    },
  });
}
