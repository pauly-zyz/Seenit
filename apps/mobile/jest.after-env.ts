import { configure } from "@testing-library/react-native";

// findBy*/waitFor default to 1 s, which is tight when the whole monorepo tests in parallel.
configure({ asyncUtilTimeout: 5000 });
