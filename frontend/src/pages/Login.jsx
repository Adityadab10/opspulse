import { SignIn } from "@clerk/react";
import AuthScreen from "../auth/AuthScreen";

export default function Login() {
  return <AuthScreen><SignIn routing="hash" /></AuthScreen>;
}
