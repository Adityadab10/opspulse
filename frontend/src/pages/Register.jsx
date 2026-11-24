import { SignUp } from "@clerk/react";
import AuthScreen from "../auth/AuthScreen";

export default function Register() {
  return <AuthScreen><SignUp routing="hash" /></AuthScreen>;
}
