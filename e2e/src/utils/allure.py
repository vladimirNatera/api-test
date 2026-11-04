from functools import wraps

import allure


def with_allure_dynamic_title(title_template: str):
    def decorate(test_function):
        @wraps(test_function)
        def wrapped(*arguments, **keyword_arguments):
            request = keyword_arguments["request"]
            callspec = getattr(request.node, "callspec", None)
            case_id = callspec.id if callspec is not None else test_function.__name__
            allure.dynamic.title(title_template.format(id=case_id))
            return test_function(*arguments, **keyword_arguments)

        return allure.title(title_template)(wrapped)

    return decorate
